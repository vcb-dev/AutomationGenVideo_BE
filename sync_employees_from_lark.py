#!/usr/bin/env python3
"""
Manual sync script for employee data from Lark to Supabase
Fetches employee records from Lark Bitable and syncs to database
"""

import psycopg2
from psycopg2.extras import RealDictCursor
import requests
import json
import time
from typing import List, Dict, Any

# Database config
DB_HOST = "aws-1-ap-southeast-1.pooler.supabase.com"
DB_PORT = 6543
DB_USER = "postgres.wbiumzxlfvlzenyuykxe"
DB_PASSWORD = "trunghieu2003Hh@"
DB_NAME = "postgres"

# Lark config
LARK_APP_ID = "cli_a9b023ef4078ded0"
LARK_APP_SECRET = "ZsmUP7zkoBVsIO1qLSCifekKeD5SdxLu"
LARK_QLTASK_BASE_ID = "UqgJw2SZOiZsAYk7ciTl11fKgjg"  # Employee/User table base
LARK_EMPLOYEE_TABLE_ID = "tblmjwNLtw8hAWns"  # Employee table ID

def get_lark_access_token() -> str:
    """Get Lark API access token"""
    url = "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal"
    payload = {
        "app_id": LARK_APP_ID,
        "app_secret": LARK_APP_SECRET
    }
    
    response = requests.post(url, json=payload)
    data = response.json()
    
    if data.get("code") != 0:
        raise Exception(f"Failed to get token: {data.get('msg')}")
    
    return data["tenant_access_token"]

def fetch_employee_records(token: str, base_id: str, table_id: str) -> List[Dict[str, Any]]:
    """Fetch all employee records from Lark Bitable"""
    url = f"https://open.larksuite.com/open-apis/bitable/v1/apps/{base_id}/tables/{table_id}/records"
    
    headers = {
        "Authorization": f"Bearer {token}",
    }
    
    all_records = []
    page_token = ""
    
    while True:
        params = {
            "text_field_as_key": True,
            "page_size": 100,
        }
        if page_token:
            params["page_token"] = page_token
        
        response = requests.get(url, headers=headers, params=params)
        data = response.json()
        
        if data.get("code") != 0:
            raise Exception(f"Lark API Error: {data.get('msg')}")
        
        if data.get("data", {}).get("items"):
            all_records.extend(data["data"]["items"])
        
        if not data.get("data", {}).get("has_more"):
            break
        
        page_token = data["data"].get("page_token", "")
        time.sleep(0.5)  # Rate limit
    
    return all_records

def extract_string(val: Any) -> str:
    """Extract string from Lark field value"""
    if not val:
        return None
    if isinstance(val, str):
        return val.strip() if val.strip() else None
    if isinstance(val, list) and len(val) > 0:
        first = val[0]
        if isinstance(first, dict):
            return first.get("name") or first.get("text")
        return str(first)
    if isinstance(val, dict):
        return val.get("name") or val.get("text")
    return str(val).strip() if str(val).strip() else None

def extract_team_list(val: Any) -> List[str]:
    """Extract team list from Lark field value"""
    if not val:
        return []
    if isinstance(val, str):
        return [s.strip() for s in val.split(",") if s.strip()]
    if isinstance(val, list):
        teams = []
        for item in val:
            if isinstance(item, str):
                teams.append(item.strip())
            elif isinstance(item, dict):
                name = item.get("name") or item.get("text")
                if name:
                    teams.append(str(name).strip())
        return [t for t in teams if t]
    if isinstance(val, dict):
        name = val.get("name") or val.get("text")
        return [str(name).strip()] if name else []
    return []

def sync_employees_to_db(employees: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Sync employee records to database"""
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME
    )
    
    cursor = conn.cursor()
    stats = {
        "synced": 0,
        "skipped": 0,
        "errors": []
    }
    
    print(f"\n📋 Syncing {len(employees)} employee records...\n")
    
    for employee in employees:
        try:
            fields = employee.get("fields", {})
            
            # Extract data
            name = extract_string(fields.get("Tên")) or extract_string(fields.get("name"))
            if not name or name == "Unknown":
                stats["skipped"] += 1
                continue
            
            email = extract_string(fields.get("Email")) or extract_string(fields.get("email"))
            employee_id = extract_string(fields.get("Mã NV")) or extract_string(fields.get("employee_id"))
            teams = extract_team_list(fields.get("Bộ phận") or fields.get("Team"))
            team_str = ", ".join(teams) if teams else None
            
            record_id = employee.get("record_id")
            
            print(f"  → Syncing: {name} ({email}) - Team: {team_str or 'N/A'}")
            
            # Update user if exists by email or full_name
            if email:
                try:
                    cursor.execute(
                        "UPDATE users SET full_name = %s, team = %s, lark_employee_record_id = %s WHERE email = %s AND is_active = true",
                        (name, team_str, record_id, email)
                    )
                    
                    if cursor.rowcount > 0:
                        stats["synced"] += 1
                        conn.commit()
                        print(f"    ✅ Updated by email")
                        continue
                except Exception as e:
                    print(f"      Error updating by email: {e}")
                    conn.rollback()
            
            # Try match by full_name
            try:
                cursor.execute(
                    "UPDATE users SET team = %s, lark_employee_record_id = %s WHERE full_name = %s AND is_active = true",
                    (team_str, record_id, name)
                )
                
                if cursor.rowcount > 0:
                    stats["synced"] += 1
                    conn.commit()
                    print(f"    ✅ Updated by full_name")
                else:
                    stats["skipped"] += 1
                    print(f"    ⊘ No matching user found in DB")
            except Exception as e:
                print(f"      Error updating by full_name: {e}")
                conn.rollback()
        
        except Exception as e:
            stats["errors"].append(f"{employee.get('record_id')}: {str(e)}")
            print(f"    ❌ Error: {str(e)}")
    
    cursor.close()
    conn.close()
    
    return stats

def main():
    print("🚀 Starting Lark Employee Sync Script")
    print(f"  Base ID: {LARK_QLTASK_BASE_ID}")
    print(f"  Table ID: {LARK_EMPLOYEE_TABLE_ID}\n")
    
    try:
        # Get token
        print("🔐 Getting Lark access token...")
        token = get_lark_access_token()
        print("✅ Token acquired\n")
        
        # Fetch records
        print("📥 Fetching employee records from Lark...")
        employees = fetch_employee_records(token, LARK_QLTASK_BASE_ID, LARK_EMPLOYEE_TABLE_ID)
        
        print(f"✅ Fetched {len(employees)} records\n")
        
        # Sync to DB
        print("💾 Syncing to database...")
        stats = sync_employees_to_db(employees)
        
        # Summary
        print(f"\n{'='*60}")
        print(f"📊 SYNC SUMMARY")
        print(f"{'='*60}")
        print(f"✅ Synced:   {stats['synced']}")
        print(f"⊘ Skipped:  {stats['skipped']}")
        print(f"❌ Errors:   {len(stats['errors'])}")
        
        if stats['errors']:
            print(f"\nError details:")
            for err in stats['errors'][:10]:
                print(f"  - {err}")
            if len(stats['errors']) > 10:
                print(f"  ... and {len(stats['errors']) - 10} more")
        
        print(f"{'='*60}\n")
        
    except Exception as e:
        print(f"\n❌ Fatal Error: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
