from os import environ
import boto3

HOSTED_ZONE_ID = environ['HOSTED_ZONE_ID']
CLUSTER_ARN = environ['CLUSTER_ARN']
ARMA_SERVICE_NAME = environ['ARMA_SERVICE_NAME']
TEAMSPEAK_SERVICE_NAME = environ['TEAMSPEAK_SERVICE_NAME']

ecs = boto3.client("ecs")
r53 = boto3.client("route53")
ec2 = boto3.client('ec2')

def update_record(record_name: str, value: str):
  response = r53.change_resource_record_sets(
    HostedZoneId = HOSTED_ZONE_ID,
    ChangeBatch = {
        "Comment": "Automatic DNS update",
        "Changes": [
            {
                "Action": "UPSERT",
                "ResourceRecordSet": {
                    "Name": record_name,
                    "Type": "A",
                    "TTL": 60,
                    "ResourceRecords": [
                        {
                            "Value": value
                        },
                    ],
                }
            },
        ]
    }
  )

def get_current_ip(service: str):
  tasks_list = ecs.list_tasks(
    cluster = CLUSTER_ARN,
    serviceName = service
  )

  task = tasks_list.get('taskArns')[0]

  task_desc = ecs.describe_tasks(
    cluster = CLUSTER_ARN,
    tasks = [task]
  )

  details = task_desc.get('tasks')[0].get('attachments')[0].get('details')

  eni = [x for x in details if x.get('name') == "networkInterfaceId"][0].get('value')

  interfaces = ec2.describe_network_interfaces(
      NetworkInterfaceIds=[eni],
  )

  interface = interfaces['NetworkInterfaces'][0]

  return interface['Association']['PublicIp']

get_current_ip(ecs, 'PathfinderInfraStack-ArmaServiceBE976F5A-ahObTo5sEvco')

def main(event, context):
    print("Started update...")
    arma_ip = get_current_ip(ARMA_SERVICE_NAME)
    print("Current IP of Arma task is", arma_ip)
    update_record("arma", arma_ip)
    print("Updated record for Arma server")
    ts_ip = get_current_ip(TEAMSPEAK_SERVICE_NAME)
    print("Current IP of Teamspeak task is", ts_ip)
    update_record("ts", ts_ip)
    print("Updated record for Teamspeak server")