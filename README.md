# Campus Desk: GitOps deployment

Campus Desk is a three-tier student management application: an Nginx frontend, a Node.js API, and MySQL. This repository uses Argo CD's **app of apps** pattern to manage the OpenShift/Kubernetes deployment from Git.

## GitOps layout

```text
gitops/
├── argocd/root-application.yaml   # Bootstrap this one Application in Argo CD
└── apps/
    ├── kustomization.yaml         # Registers the child Applications
    ├── database/                  # MySQL, Service, persistent volume claim
    ├── api/                       # REST API, Service
    └── frontend/                  # Frontend, Service, OpenShift Route
```

The root Application watches `main` and creates three child Applications. Each child watches its own directory. Argo CD automatically syncs changes and self-heals live drift. The database PVC has `Delete=false` so removing the database manifests from Git does not automatically delete stored records; manage that claim deliberately.

## Prerequisites

- An OpenShift cluster (or Kubernetes cluster with the OpenShift Route API) with `oc` and `kubectl` access.
- Argo CD installed and reachable in the cluster, in the `argocd` namespace.
- Public Docker Hub repositories for the frontend and API images, or configured image pull credentials.
- A default StorageClass that can provision a 1 GiB `ReadWriteOnce` volume.

## 1. Build and publish the images

Create Docker Hub repositories named `campus-student-api` and `campus-student-frontend`. Build and push the version referenced by the Kustomize overlays:

```bash
docker build -t YOUR_DOCKERHUB_USERNAME/campus-student-api:1.0 ./backend
docker build -t YOUR_DOCKERHUB_USERNAME/campus-student-frontend:1.0 ./frontend
docker login --username YOUR_DOCKERHUB_USERNAME
docker push YOUR_DOCKERHUB_USERNAME/campus-student-api:1.0
docker push YOUR_DOCKERHUB_USERNAME/campus-student-frontend:1.0
```

Edit `gitops/apps/api/kustomization.yaml` and `gitops/apps/frontend/kustomization.yaml`, replacing `YOUR_DOCKERHUB_USERNAME` with the Docker Hub account or organization. Commit and push this change to `main` before bootstrapping Argo CD. To deploy a new image version, push it and change the corresponding `newTag` in that app's Kustomize file; Argo CD will roll it out.

## 2. Install Argo CD and create the database secret

Argo CD must be installed before applying the root Application. On OpenShift, select your project and create the Argo CD namespace/instance according to your cluster's Argo CD installation. Verify:

```bash
oc get pods -n argocd
```

Create the destination namespace and database Secret before the database workload starts. Use strong, private passwords; do not commit them to Git:

```bash
oc create namespace campus-desk
oc create secret generic student-db-secret -n campus-desk \
  --from-literal=MYSQL_PASSWORD='choose_a_strong_app_password' \
  --from-literal=MYSQL_ROOT_PASSWORD='choose_a_different_root_password'
```

The database deployment and API both read `student-db-secret` from this namespace. If you use a different namespace, update the destination namespace in all three child Application manifests under `gitops/apps/`.

## 3. Bootstrap the app of apps

From the repository root, apply the root Application once:

```bash
oc apply -n argocd -f gitops/argocd/root-application.yaml
```

Argo CD discovers the three child Application manifests, then syncs the database, API, and frontend from Git. Check progress and resources:

```bash
oc get applications -n argocd
oc get pods,pvc,services,routes -n campus-desk
```

The `campus-desk` OpenShift Route exposes only the frontend over edge TLS. Open its host from `oc get route campus-desk -n campus-desk`. The Nginx frontend proxies `/api` requests to the internal API Service.

## Day-to-day GitOps workflow

1. Change application code, Kubernetes manifests, or an image tag in this repository.
2. Commit and push the change to `main`.
3. Argo CD detects the change and syncs the affected child Application.
4. Review status with `oc get applications -n argocd` and workload health with `oc get pods -n campus-desk`.

You can also use the Argo CD UI or CLI to inspect sync history and application health. Avoid applying application workload manifests manually after bootstrap; make desired-state changes in Git.

## Remove the deployment

Delete the root Application to stop managing the child Applications, then delete child Applications if they remain:

```bash
oc delete -n argocd -f gitops/argocd/root-application.yaml
oc delete application campus-desk-database campus-desk-api campus-desk-frontend -n argocd
```

The database PVC is protected from Argo CD deletion by its `Delete=false` sync option. To permanently delete student data, explicitly delete it after confirming the namespace and claim:

```bash
oc delete pvc student-db-data -n campus-desk
```

## Local development

For local setup without Kubernetes, start the backend from `backend/` with `npm install` and `npm start`, configure `backend/.env` from `.env.example`, and serve `frontend/` with a local HTTP server. The API provides `GET /api/health` and CRUD endpoints under `/api/students`.

## Security note

This sample application has no authentication or authorization. Anyone who can reach the public Route can view, add, edit, or delete student records. Use synthetic data only. Keep database credentials in Kubernetes Secrets and use private image registries or pull secrets if public images are not appropriate.
