import { Route, Routes } from "react-router-dom";
import "./App.css";
import HomePage from "./pages/Home";
import BlockPage from "./pages/Block";
import TransactionPage from "./pages/Transaction";
import AddressPage from "./pages/Address";
import BlocksPage from "./pages/Blocks";
import TransactionsPage from "./pages/Transactions";
import DepositsPage from "./pages/Deposits";
import WithdrawalsPage from "./pages/Withdrawals";
import ForcedTransactionsPage from "./pages/ForcedTransactions";
import NotFoundPage from "./pages/NotFound";

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/block/:headerHash" element={<BlockPage />} />
      <Route path="/blocks/:page" element={<BlocksPage />} />
      <Route path="/transaction/:txHash" element={<TransactionPage />} />
      <Route path="/address/:address" element={<AddressPage />} />
      <Route path="/transactions/:page" element={<TransactionsPage />} />
      <Route path="/deposits/:page" element={<DepositsPage />} />
      <Route path="/withdrawals/:page" element={<WithdrawalsPage />} />
      <Route
        path="/forced-transactions/:page"
        element={<ForcedTransactionsPage />}
      />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default App;
