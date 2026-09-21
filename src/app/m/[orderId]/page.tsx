import { CustomerClient } from "./CustomerClient";

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  return <CustomerClient orderId={orderId} />;
}
