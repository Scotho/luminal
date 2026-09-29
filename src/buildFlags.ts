const BUILD_MODE = import.meta.env.MODE;

export const IS_LOCAL_BUILD = BUILD_MODE === 'development';
export const IS_TEST_BUILD = BUILD_MODE === 'test';
export const IS_LIVE_BUILD = BUILD_MODE === 'production';
export const IS_HOSTED_BUILD = !IS_LOCAL_BUILD;

export const ENABLE_LOCAL_TOOLS = IS_LOCAL_BUILD;
export const ENABLE_DIAGNOSTIC_LOGS = IS_LOCAL_BUILD;
export const ENABLE_APP_CHECK = IS_HOSTED_BUILD;
export const ENABLE_PWA = IS_HOSTED_BUILD;
