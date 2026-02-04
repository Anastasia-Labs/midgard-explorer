import { prisma } from "../db";

export async function getAllAddressHistory() {
  return prisma.addressHistory.findMany();
}

export async function getAddressHistory(address: string) {
  return prisma.addressHistory.findMany({ where: { address } });
}
