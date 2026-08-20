import { useMemo } from "react";
import { CopySimpleIcon } from "@phosphor-icons/react";
import { HvIconContainer } from "@hitachivantara/uikit-react-icons";

import useCreateRule, { ACTION_ID } from "../mutations/useCreateRule";

const useCreateRuleAction = () => {
  const { createRule, isPending } = useCreateRule();

  return useMemo(
    () => ({
      id: ACTION_ID,
      label: "Add rule",
      icon: (
        <HvIconContainer size="sm">
          <CopySimpleIcon />
        </HvIconContainer>
      ),
      disabled: isPending,
      onAction: createRule,
    }),
    [createRule, isPending],
  );
};

export default useCreateRuleAction;
