import { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import "./SignUp.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

function SignUp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const navigate = useNavigate();

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

    try {
      await axios.post(`${API_BASE}/auth/signup`, { 
        email, 
        password,
        first_name: "",
        last_name: ""
      });
      setSuccess("Account created successfully. Please sign in.");
      setEmail("");
      setPassword("");
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
    <div 
      className="signup-page"
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px'
      }}
    >
      <div 
        className="signup-brand"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          marginBottom: '28px'
        }}
      >
        <span className="signup-logo" style={{ fontSize: '34px' }}>🎯</span>
        <span className="signup-brand-name" style={{ fontSize: '28px', fontWeight: '800', color: '#fff' }}>Mockmate</span>
      </div>

      <div 
        className="signup-card"
        style={{
          width: '100%',
          maxWidth: '420px',
          background: 'white',
          padding: '40px',
          borderRadius: '16px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
        }}
      >
        <h1 className="signup-title" style={{ fontSize: '22px', fontWeight: '700', textAlign: 'center', marginBottom: '6px', color: '#1e293b' }}>Create your Mockmate account</h1>
        <p className="signup-subtitle" style={{ fontSize: '14px', textAlign: 'center', color: '#64748b', marginBottom: '28px' }}>
          Practice interviews smarter with AI-driven feedback
        </p>

        <form className="signup-form" onSubmit={handleSignup} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <label className="signup-label" style={{ fontSize: '13px', fontWeight: '600', color: '#64748b', marginBottom: '6px' }}>Email</label>
          <input
            type="email"
            className="signup-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            style={{
              padding: '14px 16px',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              fontSize: '15px',
              width: '100%',
              marginBottom: '12px'
            }}
          />

          <label className="signup-label" style={{ fontSize: '13px', fontWeight: '600', color: '#64748b', marginBottom: '6px' }}>Password</label>
          <input
            type="password"
            className="signup-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 8 characters"
            required
            style={{
              padding: '14px 16px',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              fontSize: '15px',
              width: '100%',
              marginBottom: '12px'
            }}
          />

          <button
            type="submit"
            className="signup-button"
            disabled={loading}
            style={{
              marginTop: '12px',
              padding: '14px',
              borderRadius: '12px',
              border: 'none',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              fontSize: '16px',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              width: '100%',
              opacity: loading ? 0.6 : 1
            }}
          >
            {loading ? "Creating account..." : "Sign Up"}
          </button>
        </form>

        {error && <p className="signup-error" style={{ marginTop: '16px', color: '#dc2626', fontSize: '14px', textAlign: 'center' }}>{error}</p>}
        {success && <p className="signup-success" style={{ marginTop: '16px', color: '#16a34a', fontSize: '14px', textAlign: 'center' }}>{success}</p>}

        <p className="signup-footer" style={{ marginTop: '24px', textAlign: 'center', fontSize: '14px', color: '#64748b' }}>
          Already have an account?{" "}
          <span 
            className="signup-link" 
            onClick={() => navigate("/signin")}
            style={{ color: '#667eea', fontWeight: '500', cursor: 'pointer' }}
          >
            Sign in
          </span>
        </p>
      </div>
    </div>
  );
}

export default SignUp;
