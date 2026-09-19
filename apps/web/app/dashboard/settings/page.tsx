import { SettingsPanel } from "@/components/dashboard/settings-panel";
import { Loadable } from "@/components/dashboard/loadable";
import { SettingsSkeleton } from "@/components/dashboard/skeletons";
import { PageHeader } from "@/components/ui/page-header";

export default function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings" description="Every behavior that touches a customer has a switch." />
      <Loadable skeleton={<SettingsSkeleton rows={3} />} label="Loading settings">
        <SettingsPanel />
      </Loadable>
    </div>
  );
}
