import { useMemo } from "react";
import { useGetAccessControlPeers, useGetAccessControlState } from "../api/apiComponents";

const useGetAliases = () => {
  const { data: state } = useGetAccessControlState({});
  const { data: peers = [] } = useGetAccessControlPeers({});

  return useMemo(() => {
    const value = peers.map((peer) => ({ name: peer.name, value: [peer.ipv4Address] }));

    const aliases = state?.aliases;
    if (aliases != null) {
      value.push(...Object.entries(aliases.groups).map(([name, value]) => ({ name, value })));
      value.push(...Object.entries(aliases.hosts).map(([name, value]) => ({ name, value })));
    }

    return value;
  }, [peers, state?.aliases]);
};

export default useGetAliases;
