import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { fetchBlock } from "../api/block";

export default function BlockPage() {
  const { headerHash } = useParams();

  useEffect(() => {
    if (!headerHash) return;
    fetchBlock(headerHash).then((data) => console.log(data));
  }, [headerHash]);

  return <div></div>;
}
