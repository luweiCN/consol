import type { DevSession } from "@consol/core";
import { createEffect, createSignal, type Accessor } from "solid-js";
import type { DevDeployedContract } from "./runtime-types";

export function createActiveDeployedContractState(input: {
  readonly session: Accessor<DevSession | undefined>;
  readonly contracts: Accessor<readonly DevDeployedContract[]>;
  readonly preferredId: Accessor<string | null>;
  readonly onChange: (contract: DevDeployedContract | null) => void;
}) {
  const scopedContracts = () => deployedContractsForSession(input.contracts(), input.session());
  const [activeId, setActiveId] = createSignal<string | null>(scopedContracts()[0]?.id ?? null);
  const activeContract = () => scopedContracts().find((contract) => contract.id === activeId()) ?? null;
  let appliedPreferredId: string | null = null;

  createEffect(() => {
    const contracts = scopedContracts();
    const preferred = input.preferredId();
    if (preferred !== null && preferred !== appliedPreferredId && contracts.some((contract) => contract.id === preferred)) {
      appliedPreferredId = preferred;
      setActiveId(preferred);
      return;
    }
    if (contracts.length === 0) {
      setActiveId(null);
      return;
    }
    if (!contracts.some((contract) => contract.id === activeId())) {
      setActiveId(contracts[0]?.id ?? null);
    }
  });

  createEffect(() => {
    input.onChange(activeContract());
  });

  return {
    activeContract,
    activeId,
    scopedContracts,
    setActiveId,
  };
}

export function deployedContractsForSession(
  contracts: readonly DevDeployedContract[],
  session: DevSession | undefined,
): readonly DevDeployedContract[] {
  if (session === undefined) {
    return [];
  }

  const sourceTarget = session.sourceTargets.find((target) => target.target === session.target)
    ?? session.sourceTargets.find((target) => target.sourceFile === session.sourceFile && target.contract === session.contract)
    ?? session.sourceTargets.find((target) => target.contract === session.contract);
  const sourceFile = sourceTarget?.sourceFile ?? session.sourceFile;
  const targets = new Set([session.target, sourceTarget?.target].filter((target): target is string => target !== undefined));

  return contracts.filter((contract) => {
    if (contract.contract !== session.contract) {
      return false;
    }
    if (contract.workspaceRoot !== undefined && session.workspaceRoot !== undefined && contract.workspaceRoot !== session.workspaceRoot) {
      return false;
    }
    if (contract.projectRoot !== undefined && contract.projectRoot !== session.projectRoot) {
      return false;
    }
    if (contract.sourceFile !== null && sourceFile !== null) {
      return contract.sourceFile === sourceFile;
    }
    return targets.has(contract.target);
  });
}
