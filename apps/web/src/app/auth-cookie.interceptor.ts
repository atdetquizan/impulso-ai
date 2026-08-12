import { HttpBackend, HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, finalize, Observable, shareReplay, switchMap, throwError } from 'rxjs';
import { environment } from '../environments/environment';

let refreshRequest: Observable<unknown> | null = null;

export const authCookieInterceptor: HttpInterceptorFn = (request, next) => {
  const requestWithCookies = request.clone({ withCredentials: true });
  return next(requestWithCookies).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status !== 401 || request.url.includes('/auth/')) return throwError(() => error);

      const rawHttp = new HttpClient(inject(HttpBackend));
      refreshRequest ??= rawHttp.post(`${environment.apiUrl}/auth/refresh`, {}, { withCredentials: true }).pipe(
        finalize(() => { refreshRequest = null; }),
        shareReplay(1),
      );
      return refreshRequest.pipe(switchMap(() => next(requestWithCookies)));
    }),
  );
};
