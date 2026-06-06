import {
  stateKeyValueFitsType,
  type StateKeyBookContract,
  type StateKeySelection,
  type StateTupleKeySelection,
} from "@consol/core";

export type StorageKeySelection = {
  readonly address: readonly StateKeySelection[];
  readonly uint256: readonly StateKeySelection[];
  readonly bytes32: readonly StateKeySelection[];
  readonly bool: readonly StateKeySelection[];
  readonly savedAddress: readonly StateKeySelection[];
  readonly savedUint256: readonly StateKeySelection[];
  readonly savedBytes32: readonly StateKeySelection[];
  readonly savedBool: readonly StateKeySelection[];
  readonly tuple: readonly StateTupleKeySelection[];
};

export function keySelectionForContract(contract: StateKeyBookContract | undefined): StorageKeySelection {
  return {
    address: readableKeysOfType(contract, "address"),
    uint256: readableKeysOfType(contract, "uint256"),
    bytes32: readableKeysOfType(contract, "bytes32"),
    bool: readableKeysOfType(contract, "bool"),
    savedAddress: savedKeysOfType(contract, "address"),
    savedUint256: savedKeysOfType(contract, "uint256"),
    savedBytes32: savedKeysOfType(contract, "bytes32"),
    savedBool: savedKeysOfType(contract, "bool"),
    tuple: (contract?.tupleKeys ?? []).map((key) => ({
      types: key.types,
      values: key.values,
      label: key.label,
      enabled: key.enabled,
    })),
  };
}

export function savedKeysForType(selection: StorageKeySelection, typeLabel: string): readonly StateKeySelection[] {
  if (typeLabel === "address" || typeLabel === "t_address") {
    return selection.savedAddress;
  }
  if (typeLabel === "bytes32" || typeLabel === "t_bytes32") {
    return selection.savedBytes32;
  }
  if (typeLabel === "bool" || typeLabel === "t_bool") {
    return selection.savedBool;
  }
  if (typeLabel === "uint" || typeLabel === "uint256" || /^uint(?:[1-9]\d*)?$/.test(typeLabel) || /^t_uint(?:[1-9]\d*)?$/.test(typeLabel)) {
    return selection.savedUint256;
  }
  return [];
}

function readableKeysOfType(contract: StateKeyBookContract | undefined, type: string): readonly StateKeySelection[] {
  return savedKeysOfType(contract, type).filter((key) => stateKeyValueFitsType({ type, value: key.value }));
}

function savedKeysOfType(contract: StateKeyBookContract | undefined, type: string): readonly StateKeySelection[] {
  return (contract?.keys ?? []).flatMap((key) => {
    if (key.type !== type) {
      return [];
    }
    return [{
      type: key.type,
      value: key.value,
      label: key.label,
      enabled: key.enabled,
    }];
  });
}
