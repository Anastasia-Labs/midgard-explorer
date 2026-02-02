import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { fetchBlock } from "../api/block";
import { fetchTransaction } from "../api/transaction";
import { parseCbor } from "../utils";

export default function BlockPage() {
  const { headerHash } = useParams();

  useEffect(() => {
    if (!headerHash) return;
    fetchBlock(headerHash)
      .then(async (data) => {
        const txIds = data.hashes;
        const transactions = await Promise.all(
          txIds.map((txId: string) => fetchTransaction(txId)),
        );

        const parsedTransactions = transactions.map((tx) =>
          parseCbor(tx.tx),
        );
        console.log(parsedTransactions);
      })
      .catch((error) => console.error(error));
  }, [headerHash]);

  return <div></div>;
}
