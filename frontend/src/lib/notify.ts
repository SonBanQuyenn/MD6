import { notifications } from '@mantine/notifications';
import { errorMessage } from '../api/client';

export const notifySuccess = (message: string) =>
  notifications.show({ color: 'green', message });

export const notifyError = (error: unknown, title?: string) =>
  notifications.show({ color: 'red', title, message: errorMessage(error) });
