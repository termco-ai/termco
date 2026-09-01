/** Open service map extended by contract-only base packages through module
 * augmentation. The empty root deliberately contains no product services. */
// biome-ignore lint/suspicious/noEmptyInterface: contract packages declaration-merge this open map
export interface Services {}

/** Preserve literal service names while allowing independently published
 * packages to introduce keys without root registration. */
export function service<const Name extends string>(name: Name): Name {
  return name;
}

export type {
  CapabilityTransport,
  ProcessCallOptions,
  ProcessChannel,
  ProcessHostControl,
  ProcessRemoteDispose,
  ProcessTransport,
} from "./remoteCapabilities";
export {
  bindProcessTransport,
  createProcessServiceProxy,
  processTransportService,
} from "./remoteCapabilities";
export type {
  CapabilityEntry,
  ContributionOwner,
  ContributionRecord,
  Dispose,
  FeatureUiPolicy,
  KernelAnyEventListener,
  KernelEventListener,
  KernelEventsCapability,
  LiveResourceImpact,
  OptionalCapability,
  PluginActivationContext,
  PluginFeatureDescriptor,
  PluginModule,
  RuntimeFeatureInspection,
  RuntimeFeatureState,
  RuntimeFiberInspection,
  RuntimeServiceProvider,
  RuntimeSettlementDiagnostic,
} from "./runtime";
export {
  CapabilityRuntime,
  createKernelEvents,
  createLiveOptionalFacade,
  kernelEventsService,
} from "./runtime";
