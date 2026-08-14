import { HttpBackend, HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, finalize, Observable, shareReplay, switchMap, throwError } from 'rxjs';
import { environment } from '../environments/environment';
import { clearAuthSessionHint, hasAuthSessionHint } from './auth-session-hint';

let refreshRequest: Observable<unknown> | null = null;

export const authCookieInterceptor: HttpInterceptorFn = (request, next) => {
  const publicAuthRequest = [
    '/auth/magic-link',
    '/auth/session',
  ].some((path) => request.url.includes(path));
  const protectedApiRequest = request.url.startsWith(environment.apiUrl) && !publicAuthRequest;

  if (protectedApiRequest && !hasAuthSessionHint()) {
    return throwError(() => new HttpErrorResponse({
      status: 401,
      statusText: 'No local session',
      url: request.url,
    }));
  }

  const requestWithCookies = request.clone({ withCredentials: true });
  return next(requestWithCookies).pipe(
    catchError((error: HttpErrorResponse) => {
      const cannotRefresh = [
        '/auth/magic-link',
        '/auth/session',
        '/auth/refresh',
        '/auth/logout',
      ].some((path) => request.url.includes(path));
      if (error.status !== 401 || cannotRefresh) return throwError(() => error);

      const rawHttp = new HttpClient(inject(HttpBackend));
      refreshRequest ??= rawHttp.post(`${environment.apiUrl}/auth/refresh`, {}, { withCredentials: true }).pipe(
        catchError((refreshError) => {
          clearAuthSessionHint();
          return throwError(() => refreshError);
        }),
        finalize(() => { refreshRequest = null; }),
        shareReplay(1),
      );
      return refreshRequest.pipe(switchMap(() => next(requestWithCookies)));
    }),
  );
};
