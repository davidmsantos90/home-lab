import { useCallback } from "react";
import { useHvSnackbar } from "@hitachivantara/uikit-react-core";

import { useDeleteAccessControlRule } from "../../api/apiComponents";

const useDeleteRule = () => {
  const { enqueueSnackbar } = useHvSnackbar();

  const onSuccess = useCallback(() => {
    enqueueSnackbar("Rule deleted successfully", { variant: "success" });
  }, [enqueueSnackbar]);

  const onError = useCallback(
    (error: unknown) => {
      enqueueSnackbar(`Error deleting rule: ${String(error)}`, {
        variant: "error",
      });
    },
    [enqueueSnackbar],
  );

  const mutation = useDeleteAccessControlRule({ onSuccess, onError });

  const deleteRule = useCallback(
    (ruleId: string) => {
      return mutation.mutateAsync({ pathParams: { ruleId } });
    },
    [mutation],
  );

  return { ...mutation, deleteRule };
};

export default useDeleteRule;
