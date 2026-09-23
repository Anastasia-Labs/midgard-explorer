import type { EntityKind } from "../../../lib/entities";
import { Breadcrumbs, type Crumb } from "./breadcrumbs";
import { PageError } from "./pageerror";
import { PageHeader } from "./layout";

/**
 * What a list page shows when its records could not be fetched.
 *
 * The same three elements appeared in every list route: the trail back, the
 * title the page would have had, and the reason. Repeating them meant a change
 * to the shape of a failure had to be made a dozen times, and the twelfth one
 * would have been missed.
 */
export function ListError({
  crumbs,
  entity,
  title,
  message,
}: {
  crumbs: readonly Crumb[];
  entity: EntityKind;
  title: string;
  message: string;
}) {
  return (
    <>
      <Breadcrumbs items={crumbs} />
      <PageHeader entity={entity} title={title} />
      <PageError message={message} />
    </>
  );
}
