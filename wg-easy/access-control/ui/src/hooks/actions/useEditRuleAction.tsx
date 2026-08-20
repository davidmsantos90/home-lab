import { useMemo } from "react";
import { PencilIcon } from "@phosphor-icons/react";
import { HvIconContainer } from "@hitachivantara/uikit-react-icons";

import type { AccessControlRule } from "../../api/apiSchemas";
import useEditRule, { ACTION_ID } from "../mutations/useEditRule";

const useEditRuleAction = (rule: AccessControlRule, ruleIndex: number) => {
  const { editRule, isPending } = useEditRule(rule, ruleIndex);

  return useMemo(
    () => ({
      id: ACTION_ID,
      label: "Edit",
      icon: (
        <HvIconContainer size="sm">
          <PencilIcon />
        </HvIconContainer>
      ),
      disabled: isPending,
      onAction: editRule,
    }),
    [editRule, isPending],
  );
};

export default useEditRuleAction;
