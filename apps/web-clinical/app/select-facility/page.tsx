import { redirect } from "next/navigation";
// Compatibility for saved links: facility selection now lives in the workspace.
export default function SelectFacilityPage() {
  redirect("/?chooseFacility=1");
}
