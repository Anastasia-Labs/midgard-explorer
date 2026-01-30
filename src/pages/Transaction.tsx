import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { fetchTransaction } from "../api/transaction";
import { parseCbor } from "../utils";
import type { Transaction } from "../cddl";

export default function TransactionPage() {
  const { txHash } = useParams();

  useEffect(() => {
    if (!txHash) return;
    fetchTransaction(txHash).then((data) => {
      const transaction: Transaction = parseCbor(data.tx);
      console.log(transaction);
    });
  }, [txHash]);

  return <div></div>;
}
