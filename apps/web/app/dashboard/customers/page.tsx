import { CustomersList } from "@/components/dashboard/customers-list";
import { customers } from "@/lib/fixtures";

export default function CustomersPage() {
  return <CustomersList customers={customers} />;
}
