import { useMemo } from "react";
import {
  HvActionsGeneric,
  HvButton,
  HvTag,
  type HvTableColumnConfig,
} from "@hitachivantara/uikit-react-core";

import { useGetAccessControlRuleEditors } from "../../api/apiComponents";
import type { AccessControlRuleEditor } from "../../api/apiSchemas";
import useEditRuleAction from "../../hooks/actions/useEditRuleAction";
import useCreateRule from "../../hooks/mutations/useCreateRule";
import { formatSelector, formatService } from "../../lib/utils";
import Table from "../common/Table";

type RuleRow = AccessControlRuleEditor & { id: string };

const useColumns = () => {
  return useMemo<HvTableColumnConfig<RuleRow>[]>(
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
        accessor: "services",
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
          const { original: rule } = row;

          const editAction = useEditRuleAction(rule.id);

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
  const { data: ruleEditors = [] } = useGetAccessControlRuleEditors({});
  const columns = useColumns();

  const { createRule } = useCreateRule();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <HvButton variant="primaryGhost" onClick={createRule}>
          Add rule
        </HvButton>
      </div>

      <Table
        columns={columns}
        data={ruleEditors.map(({ id, rule }) => ({ id, ...rule }))}
        hidePagination
      />
    </div>
  );
};

export default RulesTable;
