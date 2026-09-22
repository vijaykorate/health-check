import { redirect } from "next/navigation";

// Admin / territory dashboards live only in the CRM (Pockit Admin Platform),
// not in the Health Check app. This route is intentionally not available here —
// send anyone who lands on it back to the technician's orders.
export default function DashboardPage() {
  redirect("/orders");
}
