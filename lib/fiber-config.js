export function liveFiberConfig(fiber) {
    const value = fiber?.effectiveConfig ?? fiber?.config;
    return (value !== null && typeof value === 'object' ? value : {});
}
//# sourceMappingURL=fiber-config.js.map