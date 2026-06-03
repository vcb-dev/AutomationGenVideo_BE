#!/usr/bin/env python3
"""
Check if 'Nguyen Kieu Anh team K1' exists in huyk_channel table
"""

import psycopg2
from psycopg2.extras import RealDictCursor
import sys

# Database connection details
DB_HOST = "aws-1-ap-southeast-1.pooler.supabase.com"
DB_PORT = 6543
DB_USER = "postgres.wbiumzxlfvlzenyuykxe"
DB_PASSWORD = "trunghieu2003Hh@"
DB_NAME = "postgres"

def check_huyk_channel():
    try:
        # Connect to database
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            user=DB_USER,
            password=DB_PASSWORD,
            database=DB_NAME
        )
        
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        # Query to search for "Nguyen Kieu Anh team K1"
        search_term = "%Nguyen Kieu Anh%team K1%"
        
        # First, let's see what columns are in huyk_channel table
        cursor.execute("""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'huyk_channel'
            ORDER BY ordinal_position
        """)
        
        columns = cursor.fetchall()
        if not columns:
            print("❌ Table 'huyk_channel' không tồn tại!")
            cursor.close()
            conn.close()
            return
        
        print("📋 Columns in huyk_channel table:")
        for col in columns:
            print(f"  - {col['column_name']}: {col['data_type']}")
        
        # Query for the data
        cursor.execute("""
            SELECT * FROM huyk_channel 
            WHERE CAST(huyk_channel TO TEXT) ILIKE %s
            LIMIT 10
        """, (search_term,))
        
        results = cursor.fetchall()
        
        if results:
            print(f"\n✅ Found {len(results)} matching record(s):")
            for row in results:
                print(f"\n{dict(row)}")
        else:
            # Try alternative search - search in each text column separately
            print("\n🔍 Searching with alternative method...")
            
            cursor.execute("""
                SELECT * FROM huyk_channel 
                WHERE name ILIKE %s OR name ILIKE %s
                LIMIT 20
            """, ('%Nguyen Kieu Anh%', '%team K1%'))
            
            results = cursor.fetchall()
            if results:
                print(f"✅ Found {len(results)} record(s) with similar name:")
                for row in results:
                    print(f"\n{dict(row)}")
            else:
                print("❌ Không tìm thấy 'Nguyen Kieu Anh' hoặc 'team K1' trong bảng")
                
                # Show sample records
                cursor.execute("SELECT * FROM huyk_channel LIMIT 5")
                samples = cursor.fetchall()
                if samples:
                    print("\n📊 Sample records from huyk_channel:")
                    for row in samples:
                        print(f"\n{dict(row)}")
        
        cursor.close()
        conn.close()
        
    except Exception as e:
        print(f"❌ Error: {type(e).__name__}: {e}")
        sys.exit(1)

if __name__ == "__main__":
    check_huyk_channel()
