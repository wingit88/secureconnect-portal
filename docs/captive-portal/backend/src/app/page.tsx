import { redirect } from "next/navigation";
import { portalHomePath } from "@/lib/portal-url";

export default function Home({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  redirect(portalHomePath(searchParams));
}
