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
  -p 8080:8080 \
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

## Deploy to an OpenShift Sandbox

These manifests deploy the frontend, API, and MySQL database in the currently selected OpenShift project. MySQL uses a 1 GiB persistent volume claim. The frontend is exposed through an OpenShift Route with edge TLS. The application images are pulled from Docker Hub; create public repositories if you want the Sandbox to pull them without image pull credentials.

### 1. Build and publish the application images

Create two repositories in [Docker Hub](https://hub.docker.com/): `campus-student-api` and `campus-student-frontend`. Set each repository's visibility to **Public** in its settings. Use your Docker Hub username in the commands below. Public visibility allows anyone to pull the images; it does not make your student data public.

From the project root, build and tag both images (replace `YOUR_DOCKERHUB_USERNAME`):

```bash
docker build -t YOUR_DOCKERHUB_USERNAME/campus-student-api:1.0 ./backend
docker build -t YOUR_DOCKERHUB_USERNAME/campus-student-frontend:1.0 ./frontend
docker login --username YOUR_DOCKERHUB_USERNAME
docker push YOUR_DOCKERHUB_USERNAME/campus-student-api:1.0
docker push YOUR_DOCKERHUB_USERNAME/campus-student-frontend:1.0
```

Docker prompts for your password or access token. Verify both `1.0` tags appear in the repositories on Docker Hub. Docker Hub can create a repository on first push, but creating each repository first lets you choose **Public** visibility before publishing. If you push first and a repository is private, change its visibility in that repository's settings.

### 2. Select the connected OpenShift project

Use the `oc` CLI session that is already logged in to your Sandbox. Check the active project before applying resources:

```bash
oc whoami
oc project
oc get projects
```

If needed, select your Sandbox project with `oc project YOUR_PROJECT_NAME`. The manifests apply to the selected project and do not create a project.

### 3. Set the Docker Hub image namespace

Edit `openshift/kustomization.yaml` and replace both occurrences of `YOUR_DOCKERHUB_USERNAME` with your Docker Hub username. The configured repository names and `1.0` tags must match the images you pushed.

### 4. Create the database credentials and deploy

Create a Kubernetes Secret in your selected project. Choose strong passwords and keep them private. This command does not add the credentials to the manifest files:

```bash
oc create secret generic student-db-secret \
  --from-literal=MYSQL_PASSWORD='choose_a_strong_app_password' \
  --from-literal=MYSQL_ROOT_PASSWORD='choose_a_different_root_password'
```

Apply the manifests and wait for the workloads:

```bash
oc apply -k openshift
oc rollout status deployment/student-db --timeout=5m
oc rollout status deployment/student-api --timeout=5m
oc rollout status deployment/campus-frontend --timeout=5m
oc get pods,pvc,svc,route
```

Get the public HTTPS URL from the `HOST/PORT` column in `oc get route`, then open it in a browser. The API and database remain internal to the project; the route exposes only the frontend. The frontend proxies `/api` requests to the API service.

### Update or remove the Sandbox deployment

After publishing a new image tag, update the `newTag` for the image in `openshift/kustomization.yaml`, then run `oc apply -k openshift` and `oc rollout status` for the updated deployment. To remove the app resources, run `oc delete -k openshift`. The database PVC is included in these manifests and will also be deleted, so deleting it removes the stored student records. Check your Sandbox's storage and project quotas if the database pod remains pending.

### Troubleshooting OpenShift

- **Image pull failure:** verify both Docker Hub repositories are public, the image names/tags in `openshift/kustomization.yaml` match, and the tag exists.
- **Database pod pending:** check `oc describe pod -l app=student-db` and `oc get pvc`; the project's quota or default storage class might not allow the requested volume.
- **API is not ready:** inspect `oc logs deployment/student-api` and `oc logs deployment/student-db`. The API waits for MySQL during startup.
- **Route is unavailable:** run `oc get route campus-desk` and `oc describe route campus-desk` to inspect its host and service target.

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
- **Port already in use:** stop the other service or change the published host port. For example, `-p 8081:8080` makes the Docker UI available at `http://localhost:8081`.

## Notes

This is a learning project. The student directory has no login or access control, so anyone who can reach the public Sandbox route can view, add, change, or delete records. Use synthetic test data only. Keep database credentials in OpenShift Secrets, not in image files or public repositories. The sample UI loads its Google Font from Google Fonts when internet access is available and falls back to system fonts otherwise.
