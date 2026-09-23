import { createElement, useCallback } from "react";
import { useHvSnackbar } from "@hitachivantara/uikit-react-core";

import {
  fetchGetAccessControlRuleEditor,
  useReplaceAccessControlRuleEditor,
} from "../../api/apiComponents";
import RuleDialog from "../../components/home/RuleDialog";
import { usePortalContext } from "../../providers/PortalProvider";

export const ACTION_ID = "edit-rule";

const useEditRule = (ruleId: string) => {
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

  const mutation = useReplaceAccessControlRuleEditor({ onSuccess, onError });

  const editRule = useCallback(async () => {
    try {
      const editor = await fetchGetAccessControlRuleEditor({
        pathParams: { ruleId },
      });
    const dialog = createElement(RuleDialog, {
      rule: editor.rule,

      labels: {
        title: "Edit rule",
        onClose: "Cancel",
        onSubmit: "Save",
      },

      onSubmit(body) {
        mutation.mutate({ pathParams: { ruleId }, body });
      },

      onClose() {
        closePortal(ACTION_ID);
      },
    });

    openPortal(ACTION_ID, dialog);
    } catch (error) {
      onError(error);
    }
  }, [ruleId, mutation, closePortal, onError, openPortal]);

  return { ...mutation, editRule };
};

export default useEditRule;
