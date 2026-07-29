# Video Production Backend API

Backend API cho hệ thống quản lý sản xuất video tự động với authentication và role-based access control.

## 🚀 Quick Start

### 1. Cài đặt dependencies

```bash
npm install
```

### 2. Khởi động PostgreSQL Database với Docker

```bash
docker-compose up -d
```

### 3. Chạy Prisma Migration

```bash
npx prisma migrate dev --name init
npx prisma generate
```

### 4. Khởi động Development Server

```bash
npm run start:dev
```

Server sẽ chạy tại: `http://localhost:3000`

Swagger API Documentation: `http://localhost:3000/api`

## 🔑 Authentication & Roles

Hệ thống hỗ trợ 4 roles:
- **ADMIN**: Quản trị hệ thống, có quyền cao nhất
- **MANAGER**: Quản lý nhóm, giám sát editors
- **EDITOR**: Chỉnh sửa video, phải được gán cho 1 manager
- **MARKETING**: Thành viên marketing

## 📝 API Endpoints

### Authentication (`/auth`)
- `POST /auth/login` - Đăng nhập (không còn tự đăng ký — tài khoản do Admin/Leader tạo qua trang HR-management)
- `GET /auth/profile` - Lấy thông tin profile (protected)

### Users (`/users`)
- `POST /users` - Tạo user mới (Admin only)
- `GET /users` - Lấy danh sách users (Admin, Manager)
- `GET /users/:id` - Lấy thông tin user
- `PATCH /users/:id` - Cập nhật user (Admin only)
- `DELETE /users/:id` - Xóa user (Admin only)

## 🧪 Testing

### Mở Prisma Studio để xem database:
```bash
npx prisma studio
```

### Test API với curl:

#### 1. Tạo Admin đầu tiên (tự đăng ký đã bị gỡ — dùng seed hoặc tạo trực tiếp trong DB, sau đó Admin tạo nhân sự qua trang HR-management)
```bash
npx prisma studio  # tạo user ADMIN đầu tiên trực tiếp trong bảng users
```

#### 2. Login
```bash
curl -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d "{\"email\":\"admin@example.com\",\"password\":\"Admin123!\"}"
```

Copy `access_token` từ response.

#### 3. Get Profile
```bash
curl -X GET http://localhost:3000/auth/profile -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## 🛠 Scripts

- `npm run start` - Chạy production mode
- `npm run start:dev` - Chạy development mode với watch
- `npm run build` - Build production
- `npm run prisma:migrate` - Chạy migration
- `npm run prisma:generate` - Generate Prisma Client
- `npm run prisma:studio` - Mở Prisma Studio

## 🔐 Environment Variables

Cấu hình trong file `.env`:

```env
NODE_ENV=development
PORT=3000
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/video_production?schema=public"
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:3001
```

## Database Schema

### User Model
- `id` - UUID (Primary Key)
- `email` - String (unique)
- `password_hash` - String
- `full_name` - String
- `role` - Enum (ADMIN, MANAGER, EDITOR, MARKETING)
- `manager_id` - UUID (nullable, for editors)
- `is_active` - Boolean
- `created_at` - DateTime
- `updated_at` - DateTime

## 📚 Tech Stack

- **NestJS** - Progressive Node.js framework
- **Prisma** - Modern database ORM
- **PostgreSQL** - Relational database
- **JWT** - JSON Web Tokens for authentication
- **Passport** - Authentication middleware
- **Swagger** - API documentation
- **bcrypt** - Password hashing
- **class-validator** - DTO validation
