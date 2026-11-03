import { ReelScreen } from "./fake-reel-screen";

export default async function ReelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReelScreen id={id} />;
}
