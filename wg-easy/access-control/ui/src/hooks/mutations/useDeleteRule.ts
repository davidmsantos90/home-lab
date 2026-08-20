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
    (ruleIndex: number) => {
      return mutation.mutateAsync({ pathParams: { ruleIndex } });
    },
    [mutation],
  );

  return { ...mutation, deleteRule };
};

export default useDeleteRule;
