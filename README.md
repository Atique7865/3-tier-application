# Campus Desk — Student Management

A small three-tier student management application built with a browser frontend, a Node.js REST API, and MySQL. It supports creating, viewing, searching, editing, and deleting student records.

## Project structure

```text
.
├── backend/
│   ├── src/db.js             # MySQL connection pool and table initialization
│   ├── src/server.js         # REST API and validation
│   ├── Dockerfile
│   └── .env.example
├── database/init.sql         # MySQL container initialization
├── frontend/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── nginx.conf            # Docker frontend and /api reverse proxy
│   └── Dockerfile
└── README.md
```

## Requirements

For manual setup: Kali Linux, Node.js 20 or newer, npm, MySQL Server 8.x, and Python 3. For the container setup: Docker Engine with the `docker` CLI. These instructions use plain `docker` commands and a user-created Docker network; they do not use Docker Compose.

## Run manually on Kali Linux

Open a terminal in the project directory. Install the tools if they are not already present:

```bash
sudo apt update
sudo apt install -y nodejs npm mysql-server python3
node --version
npm --version
```

The API requires Node.js 20 or newer. If `node --version` is lower than `v20`, install a current supported Node.js release before continuing.

### 1. Start MySQL and create the application database

```bash
sudo systemctl enable --now mysql
sudo systemctl status mysql --no-pager
sudo mysql
```

At the MySQL prompt, run the following. Replace the example password with a strong password you will use in the next step:

```sql
CREATE DATABASE student_management CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'student_app'@'127.0.0.1' IDENTIFIED BY 'change_this_password';
GRANT ALL PRIVILEGES ON student_management.* TO 'student_app'@'127.0.0.1';
FLUSH PRIVILEGES;
EXIT;
```

Check that the application account can connect:

```bash
mysql -u student_app -p student_management
```

Enter the password you chose, then run `EXIT;`.

### 2. Install and start the API

In a terminal at the project root:

```bash
cd backend
npm install
cp .env.example .env
nano .env
```

Set `DB_PASSWORD` in `backend/.env` to the password you created. The other defaults connect to MySQL on this machine. Save and close the editor, then start the API:

```bash
npm start
```

On first startup the API creates the `students` table. Leave this terminal running. In another terminal, verify the API and database connection:

```bash
curl http://localhost:3000/api/health
```

Expected response:

```json
{"status":"ok","database":"connected"}
```

### 3. Start the frontend

From the project root, in a second terminal:

```bash
cd frontend
python3 -m http.server 5173 --bind 0.0.0.0
```

Open **http://localhost:5173** in a browser. In this manual setup, the frontend sends API requests to `http://localhost:3000/api`. Keep both the API and frontend terminals running. Stop either server with `Ctrl+C`.

## Run the full application with Docker networking

Run these commands from the project root on the Kali host. This starts three separate containers joined to a bridge network: `student-frontend`, `student-api`, and `student-db`. Only the frontend and API ports are published to the host; MySQL is reachable by the API over the private Docker network.

### 1. Build the frontend and API images

```bash
docker build -t campus-student-api:1.0 ./backend
docker build -t campus-student-frontend:1.0 ./frontend
```

### 2. Create the network and persistent database volume

```bash
docker network create student-network
docker volume create student-mysql-data
```

### 3. Start MySQL

Choose your own root and application passwords and substitute them for the example values below. Use the same application password in the API command in the next step. The mounted initialization file runs on the first start of an empty data volume.

```bash
docker run -d \
  --name student-db \
  --network student-network \
  --network-alias db \
  --restart unless-stopped \
  -e MYSQL_ROOT_PASSWORD='choose_a_root_password' \
  -e MYSQL_DATABASE=student_management \
  -e MYSQL_USER=student_app \
  -e MYSQL_PASSWORD='choose_an_app_password' \
  -v student-mysql-data:/var/lib/mysql \
  -v "$PWD/database/init.sql:/docker-entrypoint-initdb.d/01-init.sql:ro" \
  mysql:8.4
```

Wait until MySQL reports that it is ready before starting the API:

```bash
docker logs -f student-db
```

When the log says `ready for connections`, press `Ctrl+C`. This stops following the logs, not the database container.

### 4. Start the API container

```bash
docker run -d \
  --name student-api \
  --network student-network \
  --restart unless-stopped \
  -p 3000:3000 \
  -e PORT=3000 \
  -e DB_HOST=db \
  -e DB_PORT=3306 \
  -e DB_NAME=student_management \
  -e DB_USER=student_app \
  -e DB_PASSWORD='choose_an_app_password' \
  campus-student-api:1.0
```

The hostname `db` resolves to MySQL through the network alias. The API creates the students table on startup. Check the API:

```bash
curl http://localhost:3000/api/health
docker logs student-api
```

### 5. Start the frontend container

```bash
docker run -d \
  --name student-frontend \
  --network student-network \
  --restart unless-stopped \
  -p 8080:80 \
  campus-student-frontend:1.0
```

Open **http://localhost:8080**. Nginx serves the frontend and forwards `/api/...` requests to `student-api` over `student-network`.

### Manage the containers

```bash
# See container state
docker ps -a

# Follow logs
docker logs -f student-api
docker logs -f student-db

# Stop the application
docker stop student-frontend student-api student-db

# Start it again
docker start student-db student-api student-frontend
```

The database survives container recreation in the named volume. To remove the application containers and network while preserving student records:

```bash
docker rm -f student-frontend student-api student-db
docker network rm student-network
```

To permanently erase the database records too, remove the volume **only if you intend to delete the stored data**:

```bash
docker volume rm student-mysql-data
```

## API routes

All routes return JSON except a successful `DELETE`, which returns HTTP 204 with no body.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Check API and database connectivity |
| `GET` | `/api/students` | List students |
| `POST` | `/api/students` | Create a student |
| `PUT` | `/api/students/:id` | Update a student |
| `DELETE` | `/api/students/:id` | Delete a student |

Student JSON fields: `name`, `email`, `course`, and `enrollment_date` (`YYYY-MM-DD`). Email addresses must be unique.

Example create request:

```bash
curl -X POST http://localhost:3000/api/students \
  -H 'Content-Type: application/json' \
  -d '{"name":"Samira Rahman","email":"samira@example.com","course":"Computer Science","enrollment_date":"2026-09-01"}'
```

## Troubleshooting

- **API cannot connect to MySQL:** check that MySQL is running (`sudo systemctl status mysql` for manual setup, or `docker logs student-db` for Docker) and that the database username, password, and host match the selected setup.
- **Docker API exits during database startup:** wait for `student-db` to report `ready for connections`, then restart the API with `docker restart student-api` and inspect `docker logs student-api`.
- **Page loads but students do not:** check the API health endpoint and browser developer console. In Docker, confirm all three containers are running and attached to `student-network` with `docker network inspect student-network`.
- **Port already in use:** stop the other service or change the published host port. For example, `-p 8081:80` makes the Docker UI available at `http://localhost:8081`.

## Notes

This is a learning project. The Docker commands use example credentials for clarity; use private secrets and restrict host port exposure before using this application beyond a local development machine. The sample UI loads its Google Font from Google Fonts when internet access is available and falls back to system fonts otherwise.
