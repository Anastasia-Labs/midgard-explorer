import { Request, Response } from "express";
import { getAddressHistory } from "../../db/address";

export async function getAddressRoute(req: Request, res: Response) {
  const address = req.query.address;
  if (typeof address !== "string" || address.length === 0) {
    return res.status(400).json({ error: "Missing address query param." });
  }

  const history = await getAddressHistory(address);
  return res.json({ history });
}
