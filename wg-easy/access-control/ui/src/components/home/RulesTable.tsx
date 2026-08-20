import { useMemo } from "react";
import {
  HvActionsGeneric,
  HvButton,
  HvTag,
  type HvTableColumnConfig,
} from "@hitachivantara/uikit-react-core";

import { useGetAccessControlRules } from "../../api/apiComponents";
import type { AccessControlRule } from "../../api/apiSchemas";
import useEditRuleAction from "../../hooks/actions/useEditRuleAction";
import useCreateRule from "../../hooks/mutations/useCreateRule";
import { formatSelector, formatService } from "../../lib/utils";
import Table from "../common/Table";

/*
  <HvTableCell align="center">
      <HvButton
        variant="secondaryGhost"
        disabled={saving}
        onClick={async () => {
          if (!window.confirm("Delete this rule?")) return;
          try {
            await deleteRule({ pathParams: { ruleIndex: index } });
            enqueueSnackbar("Rule deleted.", {
              variant: "success",
            });
          } catch (error) {
            enqueueSnackbar(
              error instanceof Error ? error.message : String(error),
              { variant: "error" },
            );
          }
        }}
      >
        Delete
      </HvButton>
    </div>
  </HvTableCell>
*/

const useColumns = () => {
  return useMemo<HvTableColumnConfig<AccessControlRule>[]>(
    () => [
      {
        Header: "Source",
        accessor: (row) => formatSelector(row.source),
        style: { minWidth: 80 },
      },
      {
        Header: "Destination",
        accessor: (row) => formatSelector(row.destination),
        style: { minWidth: 80 },
      },
      {
        Header: "Service",
        accessor: "service",
        style: { minWidth: 50 },
        Cell: ({ row }) => formatService(row.original),
      },
      {
        Header: "Action",
        accessor: "action",
        align: "center",
        style: { minWidth: 50 },
        Cell: ({ value }) => (
          <HvTag
            className="color-atmo1"
            label={value.toUpperCase()}
            color={value === "allow" ? "positive" : "negative"}
            size="sm"
          />
        ),
      },
      {
        Header: "Comment",
        accessor: "comment",
        style: { minWidth: 100 },
        Cell: ({ value }) => value ?? "—",
      },

      {
        id: "_actions",
        variant: "actions",
        disableGlobalFilter: true,
        Cell: ({ row }) => {
          const { original: rule, index } = row;

          const editAction = useEditRuleAction(rule, index);

          return (
            <HvActionsGeneric
              maxVisibleActions={0}
              actions={[editAction]}
              onAction={(_, action) => {
                // @ts-ignore fix missing type for onAction
                action.onAction?.();
              }}
            />
          );
        },
      },
    ],
    [],
  );
};

const RulesTable = () => {
  const { data: rules = [] } = useGetAccessControlRules({});
  const columns = useColumns();

  const { createRule } = useCreateRule();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <HvButton variant="primaryGhost" onClick={createRule}>
          Add rule
        </HvButton>
      </div>

      <Table columns={columns} data={rules} hidePagination />
    </div>
  );
};

export default RulesTable;
