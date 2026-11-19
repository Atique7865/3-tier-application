CREATE DATABASE IF NOT EXISTS student_management CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'student_app'@'%' IDENTIFIED BY 'change_this_password';
GRANT ALL PRIVILEGES ON student_management.* TO 'student_app'@'%';
FLUSH PRIVILEGES;
