import { createElement, useCallback } from "react";
import { useHvSnackbar } from "@hitachivantara/uikit-react-core";

import { useReplaceAccessControlRule } from "../../api/apiComponents";
import type { AccessControlRule } from "../../api/apiSchemas";
import RuleDialog from "../../components/home/RuleDialog";
import { usePortalContext } from "../../providers/PortalProvider";

export const ACTION_ID = "edit-rule";

const useEditRule = (rule: AccessControlRule, ruleIndex: number) => {
  const { enqueueSnackbar } = useHvSnackbar();
  const { openPortal, closePortal } = usePortalContext();

  const onSuccess = useCallback(() => {
    enqueueSnackbar("Rule edited successfully", { variant: "success" });
  }, [enqueueSnackbar]);

  const onError = useCallback(
    (error: unknown) => {
      enqueueSnackbar(`Error editing rule: ${String(error)}`, {
        variant: "error",
      });
    },
    [enqueueSnackbar],
  );

  const mutation = useReplaceAccessControlRule({ onSuccess, onError });

  const editRule = useCallback(() => {
    const dialog = createElement(RuleDialog, {
      rule,

      labels: {
        title: "Edit rule",
        onClose: "Cancel",
        onSubmit: "Save",
      },

      onSubmit(body) {
        mutation.mutate({ pathParams: { ruleIndex }, body });
      },

      onClose() {
        closePortal(ACTION_ID);
      },
    });

    openPortal(ACTION_ID, dialog);
  }, [rule, ruleIndex, mutation, closePortal, openPortal]);

  return { ...mutation, editRule };
};

export default useEditRule;
