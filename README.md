# Smart Scheduler - מערכת שיבוץ משמרות הוגנת

מערכת לניהול משמרות מבוססת אלגוריתם הוגנות, הבנויה בטכנולוגיות מודרניות ומוכנה לפריסה בענן.

## 🚀 טכנולוגיות

*   **Frontend**: React, Vite, Premium Dark Mode UI (Vanilla CSS).
*   **Backend**: Python FastAPI.
*   **Infrastructure**: Docker, Docker Compose, Nginx.

## 🛠️ הרצה מקומית (Local Development)

הדרך הפשוטה ביותר להריץ את המערכת היא באמצעות Docker Compose:

1.  ודא ש-Docker Desktop רץ במחשב.
2.  הרץ את הפקודה הבאה בתיקייה הראשית:

```bash
docker-compose up --build
```

המערכת תהיה זמינה בכתובת: **[http://localhost](http://localhost)**
(ה-Frontend רץ על פורט 80 ומדבר עם ה-Backend באופן אוטומטי).

## ☁️ פריסה ל-AWS (AWS Deployment)

המערכת מוכנה לפריסה ב-AWS. מומלץ להשתמש ב-**AWS App Runner** לפריסה הקלה ביותר ללא ניהול שרתים.

### אפשרות א': AWS App Runner (מומלץ)
1.  העלה את הקוד ל-GitHub.
2.  לך לקונסולת AWS App Runner.
3.  צור שירות חדש וקשר אותו ל-GitHub Repository שלך.
4.  הגדר את ה-Build Command ואת ה-Start Command לפי ה-Dockerfile.
    *   **Frontend**: הגדר שימוש ב-Docker.
    *   **Backend**: הגדר שימוש ב-Docker.

### אפשרות ב': EC2 + Docker Compose
1.  צור מכונת EC2 (למשל t3.small) עם Ubuntu.
2.  התקן Docker ו-Docker Compose על המכונה.
3.  שכפל את ה-Repository למכונה.
4.  הרץ `docker-compose up -d --build`.

## 📁 מבנה הפרויקט

*   `/frontend` - קוד צד לקוח (React).
    *   `Dockerfile` - הגדרות בנייה ל-Production (עם Nginx).
*   `/backend` - קוד צד שרת (FastAPI).
    *   `/api` - לוגיקת ה-API, מודלים, ומסד נתונים (זמני).
    *   `Dockerfile` - הגדרות הריצה לשרת.
*   `docker-compose.yml` - מנצח על כל התזמורת מקומית.
