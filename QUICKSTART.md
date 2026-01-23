# Quick Start Guide

## 🚀 Getting Started with Endeavor RAG

### Step 1: Clone & Setup Backend

```bash
# Navigate to backend
cd backend

# Create virtual environment
python -m venv .venv

# Activate virtual environment
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### Step 2: Configure Backend Environment

Create `backend/.env`:

```env
# Generate a strong secret key:
# python -c "import secrets; print(secrets.token_urlsafe(32))"
SECRET_KEY=your_generated_secret_key

# Google credentials (optional for OAuth/GenAI)
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_API_KEY=your_api_key

# MongoDB
MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net/Endeavor
MONGO_DB=Endeavor
```

### Step 3: Start Backend

```bash
cd backend
uvicorn main:app --reload
```

✅ Backend running at `http://localhost:8000`

### Step 4: Setup Frontend

```bash
cd frontend

# Install dependencies
npm install

# Configure environment
# Create .env with:
# VITE_API_URL=http://localhost:8000
```

### Step 5: Start Frontend

```bash
cd frontend
npm run dev
```

✅ Frontend running at `http://localhost:3000`

## 📝 First Time User Flow

1. **Visit** `http://localhost:3000`
2. **Sign Up** with email/password
3. **Go to Dashboard**
4. **Upload Resume** (PDF format)
5. **View Generated Questions**
6. **Answer Questions**
7. **Get Evaluation**

## 🔑 Key Features

### Authentication
- ✅ Email/Password signup & signin
- ✅ JWT token-based auth
- ✅ Google OAuth ready
- ✅ Secure password hashing

### Resume Upload
- ✅ PDF parsing
- ✅ Skill extraction
- ✅ Protected endpoint (auth required)

### Question Generation
- ✅ AI-powered using LangChain + Google GenAI
- ✅ Resume-aware questions
- ✅ Multiple difficulty levels
- ✅ 4 question categories

### Answer Evaluation
- ✅ Automated scoring (0-100)
- ✅ Detailed feedback
- ✅ Actionable suggestions
- ✅ Section-wise analysis

## 🛠️ Development Tools

### Backend Testing
```bash
# Check health
curl http://localhost:8000/health

# List all routes
curl http://localhost:8000/openapi.json
```

### Frontend Build
```bash
cd frontend

# Development build
npm run dev

# Production build
npm run build

# Preview production build
npm run preview

# Linting
npm run lint
```

## 📊 Project Statistics

| Component | Details |
|-----------|---------|
| **Backend** | FastAPI, MongoDB, LangChain |
| **Frontend** | React 18, Vite, Tailwind CSS |
| **Auth** | JWT, BCrypt, OAuth-ready |
| **Database** | MongoDB (local or Atlas) |
| **AI/ML** | Google Generative AI (Gemma) |

## 🔗 Important Links

- Backend API: `http://localhost:8000`
- Frontend App: `http://localhost:3000`
- API Docs: `http://localhost:8000/docs`
- Redoc: `http://localhost:8000/redoc`

## ⚙️ Environment Variables

### Backend (`.env`)
```env
SECRET_KEY=                    # JWT secret
GOOGLE_CLIENT_ID=              # OAuth client ID
GOOGLE_API_KEY=                # GenAI API key
MONGO_URI=                     # MongoDB connection
MONGO_DB=Endeavor
MONGO_COLLECTION=ragCollection
WORKER_COUNT=6
```

### Frontend (`.env`)
```env
VITE_API_URL=http://localhost:8000
VITE_GOOGLE_CLIENT_ID=         # For OAuth
```

## 🐛 Troubleshooting

### Backend won't start
```bash
# Check if port 8000 is in use
lsof -i :8000  # macOS/Linux
netstat -ano | findstr :8000  # Windows
```

### MongoDB connection fails
- Verify `MONGO_URI` in `.env`
- Check MongoDB is running
- Test connection: `mongosh "your_connection_string"`

### Frontend API calls fail
- Check `VITE_API_URL` in `.env`
- Verify backend is running
- Check browser console for errors

### CORS errors
- Backend CORS is wide-open for development
- For production, update `allow_origin_regex` in `api.py`

## 📚 Next Steps

1. **Customize** question categories
2. **Add** more auth providers
3. **Implement** user settings/preferences
4. **Add** question history/analytics
5. **Deploy** to production (Render + Vercel)

## 🚢 Deployment

### Deploy Backend (Render)
```bash
# Push to GitHub
git push

# Create Web Service on Render
# Build: pip install -r requirements.txt
# Start: gunicorn -w 4 -k uvicorn.workers.UvicornWorker main:app
```

### Deploy Frontend (Vercel)
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Add environment variables in Vercel dashboard
```

## 💡 Tips

- **Generate Strong SECRET_KEY**: `python -c "import secrets; print(secrets.token_urlsafe(32))"`
- **Check Database**: Use MongoDB Atlas dashboard or mongosh CLI
- **View API Docs**: Visit `http://localhost:8000/docs`
- **Debug Frontend**: Open DevTools (F12) and check Console/Network

## 📞 Support

For issues or questions:
1. Check existing GitHub issues
2. Create a new issue with details
3. Include error logs/screenshots
4. Describe your setup (OS, Python version, Node version)

---

**Happy coding! 🎉**
