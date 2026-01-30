import { Route, Routes } from "react-router-dom";
import "./App.css";
import HomePage from "./pages/Home";
import BlockPage from "./pages/Block";
import TransactionPage from "./pages/Transaction";
// import BlocksPage from "./pages/Blocks";
// import TransactionsPage from "./pages/Transactions";

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/block/:headerHash" element={<BlockPage />} />
      {/* <Route path="/blocks" element={<Navigate to="/blocks/1" replace />} /> */}
      {/* <Route path="/blocks/:page" element={<BlocksPage />} /> */}
      <Route path="/transaction/:txHash" element={<TransactionPage />} />
      {/* <Route
        path="/transactions"
        element={<Navigate to="/transactions/1" replace />}
      /> */}
      {/* <Route path="/transactions/:page" element={<TransactionsPage />} /> */}
    </Routes>
  );
}

export default App;
