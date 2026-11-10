import { Dashboard } from "@/components/Dashboard";
import { describeError } from "@/lib/cma";
import { getDashboardData, type DashboardData } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ t?: string; preview?: string }> }) {
  const { t, preview } = await searchParams;
  let initial: DashboardData | null = null;
  let error: string | null = null;
  try {
    initial = await getDashboardData(t);
  } catch (err) {
    error = describeError(err);
  }
  return <Dashboard key={t ?? "default"} initial={initial} initialError={error} templateParam={t} previewParam={preview} />;
}
