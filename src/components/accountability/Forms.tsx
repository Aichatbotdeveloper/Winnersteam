"use client";

import { ActionForm, SubmitButton } from "@/components/ui/client";
import { updateLedger, setAccommodation } from "@/server/actions/accountability";

export function LedgerStatusForm({ id, status }: { id: string; status: string }) {
  return (
    <ActionForm action={updateLedger} className="flex flex-wrap items-center gap-2" showMessage={false}>
      <input type="hidden" name="id" value={id} />
      <select name="status" defaultValue={status} className="input w-auto py-1.5 text-body-sm" aria-label="Status">
        <option value="assigned">Assigned</option><option value="in_progress">In progress</option><option value="completed">Completed</option>
      </select>
      <input name="note" maxLength={1000} placeholder="Completion note (optional)" className="input w-48 py-1.5 text-body-sm" />
      <SubmitButton size="sm" variant="outline" icon="save">Update</SubmitButton>
    </ActionForm>
  );
}

export function AccommodationToggle({ enabled }: { enabled: boolean }) {
  return (
    <ActionForm action={setAccommodation} className="space-y-3">
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      {!enabled && <input name="note" maxLength={500} placeholder="Reason (optional, e.g. injury, medical advice)" className="input" />}
      <SubmitButton variant={enabled ? "outline" : "success"} icon={enabled ? "toggle_on" : "toggle_off"}>
        {enabled ? "Turn accommodation off" : "Turn accommodation on"}
      </SubmitButton>
    </ActionForm>
  );
}
