import { createElement, useCallback } from "react";
import { useHvSnackbar } from "@hitachivantara/uikit-react-core";

import { useCreateAccessControlRule } from "../../api/apiComponents";
import RuleDialog from "../../components/home/RuleDialog";
import { usePortalContext } from "../../providers/PortalProvider";

export const ACTION_ID = "create-rule";

const useCreateRule = () => {
  const { enqueueSnackbar } = useHvSnackbar();
  const { openPortal, closePortal } = usePortalContext();

  const onSuccess = useCallback(() => {
    enqueueSnackbar("Rule created successfully", { variant: "success" });
  }, [enqueueSnackbar]);

  const onError = useCallback(
    (error: unknown) => {
      enqueueSnackbar(`Error creating rule: ${String(error)}`, {
        variant: "error",
      });
    },
    [enqueueSnackbar],
  );

  const mutation = useCreateAccessControlRule({ onSuccess, onError });

  const createRule = useCallback(() => {
    const dialog = createElement(RuleDialog, {
      labels: {
        title: "Add rule",
        onClose: "Cancel",
        onSubmit: "Add",
      },
      onSubmit(body) {
        mutation.mutate({ body });
      },

      onClose() {
        closePortal(ACTION_ID);
      },
    });

    openPortal(ACTION_ID, dialog);
  }, [mutation, closePortal, openPortal]);

  return { ...mutation, createRule };
};

export default useCreateRule;
