```
Endeavor_rag/
│
├─ 📁 backend/
│  ├─ 📁 auth/
│  │  ├─ __init__.py
│  │  ├─ models.py              # User signup/signin/token models
│  │  ├─ routes.py              # /auth endpoints (signup, signin, google)
│  │  └─ utils.py               # JWT & password utilities
│  │
│  ├─ 📁 services/
│  │  ├─ __init__.py
│  │  └─ endeavor_rag_service.py # RAG pipeline logic
│  │
│  ├─ 📁 db/
│  │  ├─ __init__.py
│  │  └─ mongo.py               # MongoDB connection & collections
│  │
│  ├─ 📁 models/
│  │  ├─ __init__.py
│  │  └─ evaluation.py          # Interview evaluation schemas
│  │
│  ├─ 📁 uploads/               # Runtime: uploaded resumes
│  │
│  ├─ api.py                    # Main FastAPI app
│  ├─ main.py                   # Entry point
│  ├─ requirements.txt          # Python dependencies
│  ├─ .env                      # Secrets (never commit)
│  └─ README.md                 # Backend docs
│
├─ 📁 frontend/
│  ├─ 📁 src/
│  │  ├─ 📁 pages/
│  │  │  ├─ SignIn.jsx          # Login page
│  │  │  ├─ SignUp.jsx          # Registration page
│  │  │  └─ Dashboard.jsx       # Main app (resume upload visible here)
│  │  │
│  │  ├─ 📁 components/
│  │  │  ├─ Navbar.jsx          # Top navigation bar
│  │  │  ├─ ProtectedRoute.jsx  # Auth guard for routes
│  │  │  └─ ResumeUpload.jsx    # Resume upload form
│  │  │
│  │  ├─ 📁 context/
│  │  │  └─ AuthContext.jsx     # Global auth state management
│  │  │
│  │  ├─ 📁 services/
│  │  │  └─ api.js              # Axios client & API endpoints
│  │  │
│  │  ├─ App.jsx                # Main app routing
│  │  ├─ main.jsx               # React entry point
│  │  └─ index.css              # Global styles (Tailwind)
│  │
│  ├─ index.html                # HTML template
│  ├─ package.json              # NPM dependencies
│  ├─ vite.config.js            # Vite bundler config
│  ├─ tailwind.config.js        # Tailwind CSS config
│  ├─ postcss.config.cjs        # PostCSS config
│  ├─ .env                      # Frontend environment variables
│  └─ README.md                 # Frontend docs
│
├─ .env                         # Root env (ignored)
├─ .gitignore                   # Git ignore rules
├─ README.md                    # Project overview
└─ QUICKSTART.md                # Getting started guide
```

## 📊 Summary

✅ **Backend** (Python + FastAPI)
- ✅ Authentication module (signup, signin, Google OAuth)
- ✅ RAG pipeline for question generation
- ✅ MongoDB integration
- ✅ Protected /generate endpoint
- ✅ Answer evaluation endpoint

✅ **Frontend** (React + Vite)
- ✅ Sign In & Sign Up pages
- ✅ Protected route wrapper
- ✅ Dashboard with resume upload
- ✅ Auth context for global state
- ✅ Tailwind CSS styling

✅ **Configuration**
- ✅ Environment variable setup (.env files)
- ✅ requirements.txt with all dependencies
- ✅ package.json with frontend dependencies
- ✅ Updated .gitignore

✅ **Documentation**
- ✅ README.md with complete setup
- ✅ QUICKSTART.md for rapid onboarding
- ✅ Backend README.md
- ✅ Frontend README.md
