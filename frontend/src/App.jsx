import { Routes, Route } from "react-router-dom";
import SignUp from "./pages/SignUp";
import SignIn from "./pages/SignIn";
import Dashboard from "./pages/Dashboard";
import Performance from "./pages/Performance";
import Jobs from "./pages/Jobs";
import Test from "./pages/Test";

function App() {
  return (
    <Routes>
      <Route path="/" element={<SignIn />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/signin" element={<SignIn />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/performance" element={<Performance />} />
      <Route path="/jobs" element={<Jobs />} />
      <Route path="/test/:topic" element={<Test />} />
    </Routes>
  );
}

export default App;
