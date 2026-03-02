import { useState, useEffect, useRef, useCallback } from "react";

import axios from "axios";

import { useNavigate } from "react-router-dom";

import "./SignIn.css";

import mockmateLogoVideo from "../assets/mockmate-logo.mp4";



const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "406943845792-1dqmvsqci74o91frrqflqnp0701e4r4v.apps.googleusercontent.com";



function SignIn() {

  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const googleBtnRef = useRef(null);



  const navigate = useNavigate();



  const handleGoogleResponse = useCallback(async (response) => {

    setError("");

    setLoading(true);

    try {

      const res = await axios.post(`${API_BASE}/auth/google`, {

        credential: response.credential,

      });

      localStorage.setItem("mockmate_token", res.data.access_token);

      localStorage.setItem("mockmate_user", JSON.stringify({

        email: res.data.email || "google-user",

        full_name: res.data.full_name || ""

      }));

      navigate("/dashboard");

    } catch (err) {

      setError(err.response?.data?.detail || "Google sign-in failed");

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

            text: "signin_with",

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

    // Google script may load after component mount

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



  const handleSignin = async (e) => {

    e.preventDefault();

    setError("");

    

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



    try {

      const res = await axios.post(`${API_BASE}/auth/signin`, {

        email,

        password,

      });



      // ✅ Store JWT

      localStorage.setItem("mockmate_token", res.data.access_token);

      localStorage.setItem("mockmate_user", JSON.stringify({

        email: res.data.email || email,

        full_name: res.data.full_name || ""

      }));



      // ✅ Redirect

      navigate("/dashboard");

    } catch (err) {

      let errorMessage = "Sign in failed";

      

      if (err.response?.data?.detail) {

        errorMessage = err.response.data.detail;

      } else if (err.response?.data?.message) {

        errorMessage = err.response.data.message;

      } else if (err.response?.status === 401) {

        errorMessage = "Invalid email or password";

      } else if (err.response?.status === 422) {

        errorMessage = "Invalid input. Please check your email and password.";

      } else if (err.message) {

        errorMessage = err.message;

      }

      

      setError(errorMessage);

    } finally {

      setLoading(false);

    }

  };



  return (
    <div className="signin-page">
      <div className="signin-brand">
        <video
          src={mockmateLogoVideo}
          autoPlay
          loop
          muted
          playsInline
          style={{ width: '72px', height: '72px', objectFit: 'contain', mixBlendMode: 'multiply', borderRadius: '14px' }}
        />
        <span className="signin-brand-name">Mockmate</span>
      </div>

      <div className="signin-card">
        <h1 className="signin-title">Welcome back</h1>
        <p className="signin-subtitle">Sign in to continue your preparation</p>

        <form className="signin-form" onSubmit={handleSignin}>
          <label className="signin-label">Email</label>
          <input
            type="email"
            className="signin-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />

          <label className="signin-label">Password</label>
          <input
            type="password"
            className="signin-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 8 characters"
            required
          />

          <button className="signin-button" disabled={loading}>
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                <span className="auth-spinner" />
                Signing in...
              </span>
            ) : "Sign In"}
          </button>
          {loading && (
            <p style={{ fontSize: '12px', color: '#8b5cf6', textAlign: 'center', marginTop: '8px', animation: 'pulse 2s ease-in-out infinite' }}>
              Server may take up to 30s to wake up on first request...
            </p>
          )}
        </form>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', margin: '24px 0', gap: '12px' }}>
          <div style={{ flex: 1, height: '1px', background: 'linear-gradient(to right, transparent, #e0e7ff, transparent)' }} />
          <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: '500' }}>or</span>
          <div style={{ flex: 1, height: '1px', background: 'linear-gradient(to right, transparent, #e0e7ff, transparent)' }} />
        </div>

        {/* Google Sign-In Button */}
        <div
          ref={googleBtnRef}
          style={{
            display: 'flex',
            justifyContent: 'center',
            minHeight: '44px',
          }}
        />

        {error && <p className="signin-error">{error}</p>}

        <p className="signin-footer">
          New to Mockmate?{" "}
          <span className="signin-link" onClick={() => navigate("/signup")}>
            Create account
          </span>
        </p>
      </div>
    </div>
  );
}

export default SignIn;
