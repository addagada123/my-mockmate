import { useState, useEffect, useRef, useCallback } from "react";

import axios from "axios";

import { useNavigate } from "react-router-dom";

import "./SignUp.css";

import mockmateLogoVideo from "../assets/mockmate-logo.mp4";



const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "406943845792-1dqmvsqci74o91frrqflqnp0701e4r4v.apps.googleusercontent.com";



function SignUp() {

  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const [success, setSuccess] = useState("");

  const [serverReady, setServerReady] = useState(false);

  const googleBtnRef = useRef(null);

  const navigate = useNavigate();



  // Pre-warm the backend on page load so it's awake by the time user submits

  useEffect(() => {

    let cancelled = false;

    axios.get(`${API_BASE}/health`, { timeout: 60000 }).then(() => {

      if (!cancelled) setServerReady(true);

    }).catch(() => {});

    return () => { cancelled = true; };

  }, []);



  const handleGoogleResponse = useCallback(async (response) => {

    setError("");

    setLoading(true);

    try {

      const res = await axios.post(`${API_BASE}/auth/google`, {

        credential: response.credential,

      });

      localStorage.setItem("mockmate_token", res.data.access_token);

      localStorage.setItem("mockmate_user", JSON.stringify({ email: "google-user" }));

      navigate("/dashboard");

    } catch (err) {

      setError(err.response?.data?.detail || "Google sign-up failed");

    } finally {

      setLoading(false);

    }

  }, [navigate]);



  useEffect(() => {

    const initGoogle = () => {

      if (window.google?.accounts?.id) {

        window.google.accounts.id.initialize({

          client_id: GOOGLE_CLIENT_ID,

          callback: handleGoogleResponse,

        });

        if (googleBtnRef.current) {

          window.google.accounts.id.renderButton(googleBtnRef.current, {

            theme: "outline",

            size: "large",

            width: "100%",

            text: "signup_with",

            shape: "pill",

          });

        }

      }

    };

    // Dynamically load Google script only on this page
    const loadGoogleScript = () => {
      if (document.querySelector('script[src*="accounts.google.com/gsi/client"]')) return;
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    };
    loadGoogleScript();

    if (window.google?.accounts?.id) {

      initGoogle();

    } else {

      const interval = setInterval(() => {

        if (window.google?.accounts?.id) {

          clearInterval(interval);

          initGoogle();

        }

      }, 100);

      return () => clearInterval(interval);

    }

  }, [handleGoogleResponse]);



  const handleSignup = async (e) => {

    e.preventDefault();

    setError("");

    setSuccess("");

    

    // Frontend validation

    if (!email || !email.includes("@")) {

      setError("Please enter a valid email address");

      return;

    }

    

    if (!password || password.length < 8) {

      setError("Password must be at least 8 characters long");

      return;

    }

    

    setLoading(true);



    // Retry helper for cold-start resilience

    const attemptRegister = async (retries = 2) => {

      try {

        const username = email.split("@")[0];

        return await axios.post(`${API_BASE}/auth/register`, {

          username,

          email,

          password,

          full_name: ""

        }, { timeout: 60000 });

      } catch (err) {

        // Retry on network errors / 503 (server waking up)

        if (retries > 0 && (!err.response || err.response?.status >= 500 || err.code === 'ECONNABORTED')) {

          await new Promise(r => setTimeout(r, 3000));

          return attemptRegister(retries - 1);

        }

        throw err;

      }

    };



    try {

      const res = await attemptRegister();

      // Auto-login: use the token returned by register

      localStorage.setItem("mockmate_token", res.data.access_token);

      localStorage.setItem("mockmate_user", JSON.stringify({

        email: res.data.email || email,

        full_name: res.data.full_name || ""

      }));

      navigate("/dashboard");

    } catch (err) {

      let errorMessage = "Signup failed";

      

      if (err.response?.data?.detail) {

        errorMessage = err.response.data.detail;

      } else if (err.response?.data?.message) {

        errorMessage = err.response.data.message;

      } else if (err.response?.status === 422 && err.response?.data?.detail) {

        // Handle validation errors

        const detail = err.response.data.detail;

        if (Array.isArray(detail)) {

          errorMessage = detail.map(d => `${d.loc[d.loc.length - 1]}: ${d.msg}`).join(", ");

        } else {

          errorMessage = detail;

        }

      } else if (err.response?.status === 422) {

        errorMessage = "Invalid email or password. Password must be at least 8 characters.";

      } else if (err.message) {

        errorMessage = err.message;

      }

      

      setError(errorMessage);

    } finally {

      setLoading(false);

    }

  };



  return (
    <div className="signup-page">
      <div className="signup-brand">
        <video
          src={mockmateLogoVideo}
          autoPlay
          loop
          muted
          playsInline
          style={{ width: '72px', height: '72px', objectFit: 'contain', mixBlendMode: 'multiply', borderRadius: '14px' }}
        />
        <span className="signup-brand-name">Mockmate</span>
      </div>

      <div className="signup-card">
        <h1 className="signup-title">Create your Mockmate account</h1>
        <p className="signup-subtitle">
          Practice interviews smarter with AI-driven feedback
        </p>

        <form className="signup-form" onSubmit={handleSignup} noValidate>
          <label className="signup-label">Email</label>
          <input
            type="email"
            className="signup-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />

          <label className="signup-label">Password</label>
          <input
            type="password"
            className="signup-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 8 characters"
            required
          />

          <button type="submit" className="signup-button" disabled={loading}>
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                <span className="auth-spinner" />
                Creating account...
              </span>
            ) : "Sign Up"}
          </button>
          {loading && !serverReady && (
            <p style={{ fontSize: '12px', color: '#8b5cf6', textAlign: 'center', marginTop: '8px', animation: 'pulse 2s ease-in-out infinite' }}>
              Waking up server, please wait...
            </p>
          )}
        </form>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', margin: '24px 0', gap: '12px' }}>
          <div style={{ flex: 1, height: '1px', background: 'linear-gradient(to right, transparent, #e0e7ff, transparent)' }} />
          <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: '500' }}>or</span>
          <div style={{ flex: 1, height: '1px', background: 'linear-gradient(to right, transparent, #e0e7ff, transparent)' }} />
        </div>

        {/* Google Sign-Up Button */}
        <div
          ref={googleBtnRef}
          style={{
            display: 'flex',
            justifyContent: 'center',
            minHeight: '44px',
          }}
        />

        {error && <p className="signup-error">{error}</p>}
        {success && <p className="signup-success">{success}</p>}

        <p className="signup-footer">
          Already have an account?{" "}
          <span className="signup-link" onClick={() => navigate("/signin")}>
            Sign in
          </span>
        </p>
      </div>
    </div>
  );
}

export default SignUp;
