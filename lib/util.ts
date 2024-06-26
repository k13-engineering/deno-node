interface IGenericErrorResponse<T> {
    error: T
};

interface IGenericSuccessResponse {
    error: undefined;
};

type TMaybeError<T, U = globalThis.Error> = (T & IGenericSuccessResponse) | (IGenericErrorResponse<U> & {
    [K in keyof T]?: undefined;
});

export type {
    TMaybeError
};
