# My Mockmate 🚀

My Mockmate is a full-stack, AI-driven interview preparation platform. It combines cutting-edge LLMs (OpenAI, Gemini, Claude, DeepSeek) with a Retrieval-Augmented Generation (RAG) pipeline to dynamically generate highly tailored technical, analytical, and communication assessments based on candidate resumes. 

The platform also features a groundbreaking **VR Mock Interview** module (built with Unity and WebXR) that allows candidates to practice live, voice-to-voice interviews in an immersive virtual environment.

---

## ✨ Key Features

- **Resume-Driven Preparation:** Upload your resume and let our RAG pipeline extract your core skills, categorize them, and suggest tailored interview topics.
- **Dynamic Assessments:** Generate custom tests on the fly using our intelligent multi-provider LLM fallback engine. 
- **Communication Testing:** Comprehensive non-technical evaluations covering Reading Comprehension, Email Writing, Grammar, and Spoken English (utilizing Web Speech API).
- **Proctoring Engine:** Includes a frontend-based camera proctoring and tab-switch detection system to enforce assessment integrity.
- **VR Mock Interviews:** Jump into a Unity-powered WebXR environment. Speak directly to an AI avatar using real-time Speech-to-Text (STT) and Text-to-Speech (TTS) pipelines.
- **Deep Analytics:** View detailed performance breakdowns, section-by-section scoring, and historical analytics in your personalized dashboard.

---

## 🛠️ Technology Stack

### Frontend (Client)
* **Framework:** React + Vite
* **Routing:** React Router v6
* **Styling:** CSS modules, modern UI/UX design paradigms
* **State & API:** React Hooks, Axios
* **VR Engine:** Unity WebGL / WebXR

### Backend (API Engine)
* **Framework:** FastAPI (Python)
* **Database:** MongoDB (PyMongo)
* **Authentication:** OAuth2 (Google), JWT, bcrypt password hashing
* **AI & RAG:** `sentence-transformers`, custom fallback logic for multi-LLM routing (Gemini, Claude, OpenAI, DeepSeek).

---

## 📦 Project Structure

```text
My Mockmate/
├── backend/                  # FastAPI Application
│   ├── api.py                # Core application & AI generation logic
│   ├── auth/                 # JWT Authentication & Registration routes
│   ├── db/                   # MongoDB connection logic
│   └── endeavor_rag_service.py # Core RAG engine for Resume parsing
│
├── frontend/                 # React Application
│   ├── public/               # Static assets & Unity VR Builds
│   ├── src/
│   │   ├── components/       # Reusable UI elements (Camera Proctor, etc.)
│   │   ├── pages/            # Application views (Dashboard, Tests, etc.)
│   │   └── hooks/            # Custom React hooks
│   └── package.json          # Frontend dependencies
│
└── unity/                    # Unity VR Source Scripts
    └── MockmateVR/           # STT, TTS, Animation Bridges for WebXR
```

---

## 🚀 Getting Started

### 1. Environment Configuration
Create a `.env` file in the `backend/` directory using the provided `railway.toml` or `render.yaml` variables.

**Required Variables:**
```env
# Database & Auth
MONGO_URI=mongodb+srv://<user>:<password>@cluster0...
SECRET_KEY=your_super_secret_jwt_key

# AI Providers
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...

# CORS (Comma separated origins)
CORS_ORIGINS=http://localhost:5173
```

### 2. Backend Setup
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create a virtual environment and install dependencies:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```
   > **Note:** Use `requirements-dev.txt` for local development if you require local ML models like `torch` and `sentence-transformers`.

3. Run the FastAPI server:
   ```bash
   uvicorn api:app --reload --port 8000
   ```

### 3. Frontend Setup
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install Node dependencies:
   ```bash
   npm install
   ```
3. Start the Vite development server:
   ```bash
   npm run dev
   ```

---

## 🛡️ Architecture & Security
- **Multi-LLM Fallback:** The API handles API quotas gracefully. If Gemini hits a rate limit, the system instantly falls back to Claude or OpenAI to ensure candidates never experience a test generation failure.
- **Circuit Breakers:** Built-in fault tolerance temporarily blocks failing AI providers to preserve API credits and latency.
- **Proctoring Integrity:** Employs frontend heuristics (camera snapshot verifications, fullscreen locks, and visibility API tab-switch tracking) to ensure fair test-taking environments.

---

## 📄 License
All rights reserved. Unauthorized copying of this project, via any medium, is strictly prohibited. Proprietary and confidential.
