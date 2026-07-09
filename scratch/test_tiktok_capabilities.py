import requests
import json

# Thông tin App bạn vừa cung cấp
CLIENT_KEY = "7629607469592870929"
CLIENT_SECRET = "158587a761bfefcd2799a585c98c2134aa38b95a"

def test_tiktok():
    print("--- ĐANG KIỂM TRA KHẢ NĂNG CỦA APP TIKTOK ---")
    
    # 1. Lấy Client Access Token (Token cấp ứng dụng)
    url = "https://open.tiktokapis.com/v2/oauth/token/"
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    data = {
        "client_key": CLIENT_KEY,
        "client_secret": CLIENT_SECRET,
        "grant_type": "client_credentials"
    }
    
    try:
        response = requests.post(url, headers=headers, data=data)
        if response.status_code != 200:
            print(f"Lỗi: Không lấy được token. Status: {response.status_code}")
            print(f"Phản hồi: {response.text}")
            return
            
        res_data = response.json()
        token = res_data.get("access_token")
        print(f"[\u2713] Token ứng dụng: OK (Bắt đầu bằng {token[:10]}...)")
        print(f"    - Loại token: {res_data.get('token_type')}")
        print(f"    - Hết hạn sau: {res_data.get('expires_in')} giây")

        print("\n--- CÁC LOẠI DỮ LIỆU CÓ THỂ TRUY XUẤT ---")
        print("1. [Cơ bản] Thông tin Profile: Tên hiển thị, avatar, mã định danh người dùng.")
        print("2. [Thống kê] Chỉ số Kênh: Số người theo dõi (followers), số lượt thích (likes), số video.")
        print("3. [Nội dung] Video: Danh sách video đã đăng, tiêu đề, lượt xem (view count) cơ bản.")
        print("4. [Chuyên sâu] Video Insights: Số liệu chi tiết (Reach, Play time...) - Thường cần Business API.")

        print("\n--- BƯỚC TIẾP THEO ĐỂ KIỂM TRA DỮ LIỆU THẬT ---")
        print("Vì dữ liệu kênh là riêng tư, bạn cần thực hiện 'User Authorization' trên web:")
        print("1. Đảm bảo Backend đang chạy (npm run start:dev).")
        print("2. Truy cập: http://localhost:3000/api/oauth/tiktok")
        print("3. Sau khi đồng ý, hệ thống sẽ in ra thông tin kênh của bạn trong log của Backend.")
        
    except Exception as e:
        print(f"Lỗi hệ thống: {e}")

if __name__ == "__main__":
    test_tiktok()
