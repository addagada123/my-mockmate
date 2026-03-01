import { Routes, Route, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import axios from "axios";
import SignUp from "./pages/SignUp";
import SignIn from "./pages/SignIn";
import Dashboard from "./pages/Dashboard";
import Performance from "./pages/Performance";
import Jobs from "./pages/Jobs";
import Test from "./pages/Test";
import CommunicationTest from "./pages/CommunicationTest";
import TopicDashboard from "./pages/TopicDashboard";
import SectionTestWrapper from "./pages/SectionTestWrapper";

function App() {
  const navigate = useNavigate();

  useEffect(() => {
    // Add a response interceptor
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response && error.response.status === 401) {
          // Verify if it's a "Could not validate credentials" error or similar auth issue
          // Clear local storage and redirect to signin
          localStorage.removeItem("mockmate_token");
          localStorage.removeItem("mockmate_user");
          navigate("/signin");
        }
        return Promise.reject(error);
      }
    );

    // Clean up interceptor on unmount
    return () => {
      axios.interceptors.response.eject(interceptor);
    };
  }, [navigate]);

  return (
    <Routes>
      <Route path="/" element={<SignIn />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/signin" element={<SignIn />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/performance" element={<Performance />} />
      <Route path="/jobs" element={<Jobs />} />
      <Route path="/test/:topic" element={<Test />} />
      <Route path="/communication-test" element={<CommunicationTest />} />
      <Route path="/topic-dashboard/:sessionId" element={<TopicDashboard />} />
      <Route path="/section-test/:sessionId/:topic/:difficulty" element={<SectionTestWrapper />} />
    </Routes>
  );
}

export default App;
